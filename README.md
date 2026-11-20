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
- **Projects** show the exact weight in grams when the author recorded one
  (grams, kilograms, ounces or pounds are all recognized and converted).
- **Patterns** almost never record a gram total, so the chip shows an
  **estimate** (marked with `≈`): they *do* record yardage and yarn weight
  (fingering, DK, worsted…), and each weight class has a typical grams-per-meter
  range. Example: 100 m of worsted ≈ 56 g. Hover a chip to see how the estimate
  was computed — the real weight depends on the yarn you pick.
- The floating **"Yarn grams filter" panel** (bottom-right) sets a
  **min/max grams** range and can hide results with no gram info.
- Results are cached for 14 days per page; **clear cache** to refresh. Listings
  that paginate or re-sort update automatically.

## Install (unpacked, developer mode)

1. Download / clone this folder.
2. Open Chrome and go to `chrome://extensions`.
3. Enable **Developer mode** (toggle in the top-right corner).
4. Click **Load unpacked** and select this folder.
5. Open `https://www.ravelry.com/patterns/search`, browse patterns, and use the
   floating panel to filter by yarn grams.

## Limitations

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
| `panel.css`    | Styling for the filter panel and chips                |
| `icons/`       | Toolbar/extension icons (yarn ball)                   |
| `make_icon.py` | Script that generates the icons                       |
