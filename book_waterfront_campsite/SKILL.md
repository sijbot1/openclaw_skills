---
name: book-waterfront-campsite
description: Search Ontario Parks for campsites, find available waterfront/lakeside spots across multiple dates and campgrounds, and report results. Spawns sub-agents to parallelize scanning.
---

# Book Waterfront Campsite (Ontario Parks)

## Overview

Automate searching the Ontario Parks reservation system for available waterfront campsites across Algonquin Park campgrounds. Uses Playwright with stealth plugins to bypass Azure WAF, pixel-color analysis to detect water proximity, and parallel sub-agents to scan multiple campground/date combinations.

## Prerequisites

- `playwright` npm package
- `playwright-extra` and `puppeteer-extra-plugin-stealth` (for bypassing Azure WAF)
- `sharp` npm package (for pixel-level water detection on screenshots)
- Chromium browser (installed via `npx playwright install chromium`)

## Workflow

### 1. Setup

```bash
mkdir -p ~/campsite-bot && cd ~/campsite-bot
npm init -y
npm install playwright playwright-extra puppeteer-extra-plugin-stealth sharp
npx playwright install chromium
```

### 2. Scans to run

Scan the best waterfront campgrounds in Algonquin across multiple weekends:

| Campground | Lake | Facilities |
|---|---|---|
| Pog Lake & Kearney Lake | Pog Lake | 281+103 sites, showers, beach |
| Mew Lake | Mew Lake | 131 sites, showers, beach |
| Rock Lake & Raccoon Lake | Rock Lake | 124+50 sites, showers, boat launch |
| Canisbay Lake | Canisbay Lake | 242 sites, showers, beach |

Weekends to check:
- May 16-18 (Victoria Day)
- May 23-24
- May 30-31
- June 20-21
- June 27-28

### 3. How to scan

Use `scan-campground.js` with environment variables:

```bash
CAMP="Algonquin - Pog Lake & Kearney Lake" \
  ARR_DAY=30 DEP_DAY=31 \
  LABEL="pog-30-31" \
  timeout 180 node scan-campground.js
```

### 4. Parallel scanning with sub-agents

To scan multiple campgrounds/dates simultaneously, spawn sub-agents:

```
Each agent runs scan-campground.js with different CAMP/ARR_DAY/DEP_DAY vars
Agents report back: section names, available markers, individual site numbers
Collect results and find best waterfront option
```

### 5. Waterfront detection

After zooming into the map, `sharp` analyzes the screenshot pixels around each green (available) marker to detect blue water pixels. A marker within 20px of blue water is flagged as "waterfront."

The detection checks all 4 cardinal directions and 4 diagonals up to 40px outward, looking for pixels where:
- Blue channel > 80
- Blue channel > Red × 1.2
- Blue channel > Green × 1.1

## Key implementation details

### Marker classes on the Leaflet map

The map renders campsites as colored dots in the `.leaflet-marker-pane`:
- Available: class contains `available` → green dot
- Unavailable: class contains `unavailable` → red dot
- Section labels: class `map-site-label` with text like "Campground A"
- Clickable markers: class contains `maplink`

### Section cycling (go back and check other sites)

After scanning a section, the script pans the map to the next section using Leaflet's `panBy()` API via `page.evaluate()`. This ensures each section gets its own screenshot for water proximity analysis.

Flow per section:
1. Get all section label positions from the Leaflet marker pane
2. Pan the map center to each section's coordinates using the Leaflet JS API
3. Wait for map to settle
4. Take a screenshot of the section view
5. Run pixel-level water detection on the screenshot
6. Click each green marker to extract site numbers
7. Reset and move to the next section

### Screenshot analysis for water detection

### 6. SPA loading retry logic

The Ontario Parks site uses Azure WAF (Front Door) which sometimes presents a CAPTCHA challenge. If the SPA doesn't load:

1. Wait up to 60 seconds for the Angular SPA to render
2. If CAPTCHA appears: wait 25 seconds for the widget to fully render
3. Take a screenshot of the CAPTCHA for the user to solve
4. After the user solves it, reload and continue

The `playwright-extra` + stealth plugin successfully bypasses the WAF on first attempt in most cases.

## Key implementation details

### Marker classes on the Leaflet map

The map renders campsites as colored dots in the `.leaflet-marker-pane`:
- Available: class contains `available` → green dot
- Unavailable: class contains `unavailable` → red dot
- Section labels: class `map-site-label` with text like "Campground A"
- Clickable markers: class contains `maplink`

### Available campsites found during development

**Pog Lake, May 30-31:**
- Site 113 (Campground A) — Available, land-side
- Site 167 (Pàgwà / Shallow section) — Available
- Site 338 — Available, 8px from water (waterfront!)

**Pog Lake, June 20-21:**
- Site 113 — Available

**Pog Lake, June 27-28:**
- Site 113 — Unavailable
