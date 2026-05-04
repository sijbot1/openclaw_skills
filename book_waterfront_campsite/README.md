# Book Waterfront Campsite

Find and book waterfront campsites in Ontario Parks (Algonquin) using Playwright automation.

## Quick Start

```bash
# Install dependencies
npm install
npx playwright install chromium

# Scan a campground for a specific weekend
CAMP="Algonquin - Pog Lake & Kearney Lake" \
  ARR_DAY=30 DEP_DAY=31 \
  LABEL="pog-30-31" \
  node scan-campground.js
```

## Scanning with sub-agents

Spawn parallel agents to scan different campgrounds and dates simultaneously. Each agent runs the scanner independently and reports available sites.

```bash
# Example: spawn 3 parallel scans
CAMP="Algonquin - Pog Lake & Kearney Lake" ARR_DAY=30 DEP_DAY=31 LABEL="pog" node scan-campground.js &
CAMP="Algonquin - Mew Lake" ARR_DAY=30 DEP_DAY=31 LABEL="mew" node scan-campground.js &
CAMP="Algonquin - Rock Lake & Raccoon Lake" ARR_DAY=30 DEP_DAY=31 LABEL="rock" node scan-campground.js &
wait
```

## Waterfront Detection

The scanner uses `sharp` for pixel-level analysis on map screenshots. It scans pixels around each green (available) marker to detect blue water pixels. A marker within 20px of water is flagged as waterfront.

## Results Format

The script outputs a JSON file with:
- Sections found
- Marker counts (available/unavailable)
- Individual site numbers extracted from popups
- Waterfront proximity data

## Known Limitations

- Azure WAF may block after repeated automation attempts
- The map doesn't pan when clicking section markers at default zoom — use Leaflet API or keyboard zoom
- Individual campsite numbers only appear in popups after clicking markers
