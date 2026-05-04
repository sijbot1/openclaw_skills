---
name: book-waterfront-campsite
description: Recursively search Ontario Parks for waterfront campsites across multiple regions, parks, campgrounds, and dates. Uses Playwright stealth automation with pixel-level water detection.
---

# Book Waterfront Campsite (Ontario Parks)

## Overview

Automated Ontario Parks campsite finder that searches recursively:
1. Scans a campground for waterfront sites → found? Report & stop
2. Not found? Try next campground in the same park
3. All campgrounds tried? Move to next park in the region
4. All parks tried? Move to next region
5. All regions tried? Try next weekend
6. Loop until waterfront found or all options exhausted

Uses Playwright with stealth plugins (bypasses Azure WAF), pixel-color analysis via `sharp` to detect water proximity in map screenshots, and the orchestrator coordinates searches across the search space.

## Search Hierarchy

```
Regions (geographic areas)
└── Parks (within each region)
    └── Campgrounds (within each park, discovered at runtime)
        └── Dates (week by week)
```

### Included Regions & Parks

**Algonquin Park** (known campgrounds hardcoded)
- Pog Lake & Kearney Lake — best lakefront, 281+103 sites, beach, showers
- Mew Lake — 131 sites, lakefront, beach, showers
- Rock Lake & Raccoon Lake — on Rock Lake, boat launch
- Canisbay Lake — on Canisbay Lake, beach, showers
- Lake Of Two Rivers

**Georgian Bay / Muskoka** (campgrounds discovered at runtime)
- Killbear — Georgian Bay waterfront
- Awenda — Georgian Bay
- Six Mile Lake
- Arrowhead

**Lake Huron / Southwestern**
- Pinery — Lake Huron beach
- Rondeau
- Rock Point

**Lake Ontario / Eastern**
- Sandbanks — iconic beach
- Presqu'ile
- Bon Echo
- Charleston Lake

### Dates (tried in order)
- May 16-18 (Victoria Day), May 23-24, May 30-31
- June 6-7, June 13-14, June 20-21, June 27-28
- July 4-5+

## Prerequisites

```bash
npm install playwright playwright-extra puppeteer-extra-plugin-stealth sharp
npx playwright install chromium
```

## Usage

### Single scan

```bash
CAMP="Algonquin - Pog Lake & Kearney Lake" \
  ARR_DAY=30 DEP_DAY=31 \
  LABEL="pog-30-31" \
  timeout 180 node scan-campground.js
```

### Full recursive search

```bash
node orchestrator.js
```

The orchestrator will:
1. Try each campground at each park in each region
2. For parks with unknown campgrounds, run an autocomplete discovery query
3. Scan → check waterfront → repeat until found or exhausted
4. Report the best results sorted by water proximity

## Waterfront Detection

Uses `sharp` pixel analysis on map screenshots. Scans pixels around each green (available) marker in 8 directions up to 40px outward. Water detected when:
- Blue channel > 80
- Blue > Red × 1.2
- Blue > Green × 1.1

A marker within 20px of blue water is flagged as "waterfront."

## Prerequisites

- `playwright` npm package (or `playwright-extra` with stealth for Azure WAF bypass)
- `sharp` npm package (pixel-level water detection)
- Chromium browser

## Workflow

### When searching (follow in order):

1. Run `node orchestrator.js` to start the recursive search
2. Orchestrator tries dates from soonest → latest
3. For each date, tries regions → parks → campgrounds
4. Unknown parks' campgrounds are discovered via Playwright autocomplete query
5. Each scan takes ~90-180 seconds (load SPA → search → zoom → scan sections → detect water)
6. Results are printed to console as they come in
7. **First waterfront find stops the search** and prints booking details

### If orchestrator can't find anything:

1. Try running individual `scan-campground.js` for specific campgrounds
2. Add more regions/parks to the REGIONS array in orchestrator.js
3. Check if Azure WAF is blocking (try stealth plugin)
4. Manually check the Ontario Parks website for the desired dates

## Key details

### Leaflet marker classes
- Available: class contains `available` (green dot)
- Unavailable: class contains `unavailable` (red dot)
- Section labels: class `map-site-label` with text
- Clickable: class contains `maplink`

### Section cycling
Each section in a campground is scanned by:
1. Getting section label positions from the marker pane
2. Panning the Leaflet map to center on each section
3. Taking a screenshot for water pixel analysis
4. Clicking green markers to extract site numbers
5. Moving to the next section

### Azure WAF bypass
The site uses Azure Front Door WAF. Playwright-extra with puppeteer-extra-plugin-stealth bypasses it reliably. Without stealth, CAPTCHA challenges appear after 1-3 requests.
