# Ravelry Gram Filter (Chrome Extension)

A Chrome extension that shows how many **grams of yarn** each project on
[ravelry.com](https://www.ravelry.com/) used, and lets you **filter project
search results by yarn weight (min/max grams)**.

## How it works

- On any Ravelry project listing (e.g. `https://www.ravelry.com/projects/search`
  or someone's project page), the extension adds a small **green chip** next to
  each project showing the total yarn weight in grams.
- Values come from each project's own page ("packs" section), fetched in the
  background with your existing Ravelry login — **no API keys needed**.
- Weights recorded in **grams, kilograms, ounces and pounds** are recognized and
  converted to grams. Projects that only record yardage/skeins are marked
  "no g" (a length can't be converted to grams without knowing the yarn).
- A floating **"Yarn grams filter" panel** (bottom-right corner) lets you set a
  **min and max grams** range and optionally hide projects with no gram info.
- Results are cached in your browser for 14 days (per project) so pages load
  fast on repeat visits. Use **clear cache** in the panel to refresh.
- The panel is AJAX-aware: paginating or sorting the search results updates the
  chips automatically.

## Install (unpacked, developer mode)

1. Download / clone this folder.
2. Open Chrome and go to `chrome://extensions`.
3. Enable **Developer mode** (toggle in the top-right corner).
4. Click **Load unpacked** and select this folder.
5. Open `https://www.ravelry.com/projects/search`, browse projects, and use the
   floating panel to filter.

## Limitations

- Ravelry only shows a gram total if the project author recorded one
  (many record yards or meters instead). Those projects show "no g" and can be
  hidden via the checkbox.
- Ravelry's HTML can change over time; the parser contains fallbacks but may
  need an update if the site markup changes.
- Scraping fetches one page per visible project — be considerate, the built-in
  cache keeps repeat visits lightweight.

## Files

| File           | Purpose                                          |
| -------------- | ------------------------------------------------ |
| `manifest.json`| Extension manifest (Manifest V3, permissions)     |
| `content.js`   | Chip injection, gram parsing, filtering logic     |
| `panel.css`    | Styling for the filter panel and chips            |
