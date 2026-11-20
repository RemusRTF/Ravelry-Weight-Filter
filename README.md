# Ravelry Yarn Weight Filter (Chrome Extension)

A Chrome extension that shows how much **yarn (in grams)** Ravelry patterns and
projects use, and lets you **filter pattern/project search results by yarn
weight**.

## How it works

- On Ravelry pattern listings (e.g. `https://www.ravelry.com/patterns/search`)
  and project listings (e.g. `https://www.ravelry.com/projects/search`), the
  extension adds a small **green chip** next to each result showing the total
  yarn weight in grams.
- Pages are fetched in the background with your existing Ravelry login —
  **no API keys needed**.
- **Projects** show the exact weight in grams from the "How much?" field
  (grams, kilograms, ounces or pounds are all recognized and converted).
- **Patterns** almost never record a gram total, so the chip shows an
  **estimate** (marked with `≈`): they *do* record yardage and yarn weight
  (fingering, DK, worsted…), and each weight class has a typical grams-per-meter
  range. If the pattern lists a suggested yarn with `meters / grams`, that
  ratio is used directly. **Combined yarns are handled**: multiple weights in
  the "Yarn weight" field (e.g. `Worsted + Lace`) are summed — worsted + lace
  ≈ aran-weight density. Hover a chip to see how the estimate was computed.
- The floating **"Yarn grams filter" panel** (bottom-right) sets a
  **min/max grams** range and can hide results with no gram info. Chip and
  panel run in the same frame (results are Ajax-injected into the page);
  state stays in sync via `chrome.storage`, and the script also runs in
  sub-frames (`all_frames`) as a safety net for other Ravelry layouts.
- Results are cached for 14 days per page; **clear cache** to refresh. Listings
  that paginate or re-sort update automatically.
- Search pages are normalized to **25 results per page** (added to the search
  hash when missing or smaller, so page counts stay consistent).
- Every result also gets a **green cost badge** (e.g. `≈ €12`). For patterns the
  cost is computed from **live yarn prices at Hobbii (hobbii.de, EUR)**: each
  suggested yarn on the pattern page is matched against Hobbii's catalogue and
  priced per gram, then multiplied by the meters each strand uses. This works
  across combined yarns too (each strand is priced with its own yarn). Hover the
  badge to see which yarns were matched. If a yarn can't be matched (exact
  brand/colorways often differ) the badge falls back to the manual
  **price/100g** value in the filter panel (default $10) and shows `$`.

- **Pink yarn-ball toolbar icon**: click it to toggle the extension — the icon
  turns gray and the panel/chips are removed from the page; click again to
  re-enable. The state is remembered per browser (not per tab).

## Install (unpacked, developer mode)

1. Download / clone this folder.
2. Open Chrome and go to `chrome://extensions`.
3. Enable **Developer mode** (toggle in the top-right corner).
4. Click **Load unpacked** and select this folder.
5. Open `https://www.ravelry.com/patterns/search`, browse patterns, and use the
   floating panel to filter by yarn grams.

## Limitations

- Store prices come from **Hobbii (hobbii.de, EUR)** — Hobbii carries its own
  brands, so a pattern yarn like "DROPS Kid-Silk" may be priced with the closest
  matching product (e.g. "Friends Kid Silk"), and some yarns have no comparable
  product and fall back to the manual price/100g setting.
- Pattern gram values are estimates from yardage + yarn weight class, not exact
  numbers — multi-strand or heavily-cabled work will deviate.
- Projects with only yardage/skeins recorded show "no g" and can be hidden via
  the checkbox.
- Ravelry's HTML can change over time; the parser contains fallbacks but may
  need an update if the site markup changes.
- Scraping fetches one page per visible result — be considerate; the built-in
  cache keeps repeat visits lightweight.

## Files

| File           | Purpose                                              |
| -------------- | ---------------------------------------------------- |
| `manifest.json`| Extension manifest (Manifest V3, icons, permissions)  |
| `content.js`   | Chip injection, gram parsing/estimation, filtering    |
| `background.js`| Service worker: Hobbii (EU) yarn price lookups        |
| `panel.css`    | Styling for the filter panel and chips                |
| `icons/`       | Toolbar/extension icons (yarn ball)                   |
| `make_icon.py` | Script that generates the icons                       |
