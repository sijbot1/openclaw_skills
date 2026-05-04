/**
 * Campground Scanner — parameterized by env vars
 * Usage: CAMP="Algonquin - Pog Lake & Kearney Lake" ARR_DAY=30 DEP_DAY=31 node scan-campground.js
 */
const { chromium } = require('playwright-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
chromium.use(StealthPlugin());
const path = require('path');
const fs = require('fs');

const CAMP = process.env.CAMP;
const ARR = process.env.ARR_DAY;
const DEP = process.env.DEP_DAY;
const LABEL = process.env.LABEL || `${CAMP}-${ARR}-${DEP}`.replace(/[^a-z0-9]/gi, '-').substring(0, 60);

const OUT = path.join(__dirname, `results-${LABEL}.json`);
const SS = path.join(__dirname, `shots-${LABEL}`);
fs.mkdirSync(SS, { recursive: true });

let sn = 0;
async function shot(p, l) {
  sn++; const f = path.join(SS, `${String(sn).padStart(2, '0')}-${l.replace(/[^a-z0-9]/gi, '-')}.png`);
  await p.screenshot({ path: f, fullPage: false }); return f;
}

(async () => {
  console.log(`SCANNING: ${CAMP} | ${ARR}-${DEP}`);

  const b = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const p = await b.newPage({ viewport: { width: 1440, height: 900 }, locale: 'en-CA' });

  await p.goto('https://reservations.ontarioparks.ca/', { waitUntil: 'load', timeout: 60000 });
  for (let i = 0; i < 30; i++) {
    if (await p.evaluate(() => !!document.querySelector('#park-autocomplete-input'))) break;
    await p.waitForTimeout(1000);
  }

  // Search
  await p.locator('#park-autocomplete-input').click({ force: true }).catch(() => {});
  await p.waitForTimeout(200);
  await p.locator('#park-autocomplete-input').fill('');
  await p.locator('#park-autocomplete-input').type(CAMP, { delay: 12 });
  await p.waitForTimeout(1000);
  await p.locator('mat-option').first().click({ force: true });
  await p.waitForTimeout(300);
  await p.keyboard.press('Escape'); await p.waitForTimeout(200);
  await p.locator('#arrival-date-field').click({ force: true });
  await p.waitForTimeout(800);
  await p.locator(`.mat-calendar-body-cell-content:has-text("${ARR}")`).first().click({ force: true });
  await p.waitForTimeout(200);
  await p.locator(`.mat-calendar-body-cell-content:has-text("${DEP}")`).first().click({ force: true });
  await p.waitForTimeout(200);
  await p.locator('#party-size-field').click({ force: true }).catch(() => {});
  await p.waitForTimeout(200);
  await p.locator('#party-size-field').fill('2');
  await p.locator('#equipment-field').click({ force: true });
  await p.waitForTimeout(400);
  await p.locator('mat-option:has-text("Single Tent")').first().click({ force: true });
  await p.waitForTimeout(200);
  await p.locator('button:has-text("Search")').click();
  await p.waitForTimeout(8000);
  await shot(p, 'map');

  // Get marker count
  const stats = await p.evaluate(() => {
    const pane = document.querySelector('.leaflet-marker-pane');
    if (!pane) return { error: 'no pane' };
    const counts = {};
    pane.querySelectorAll(':scope > div').forEach(d => {
      const cls = typeof d.className === 'string' ? d.className : '';
      let s = 'other';
      if (cls.includes('available')) s = 'available';
      else if (cls.includes('unavailable')) s = 'unavailable';
      counts[s] = (counts[s] || 0) + 1;
    });
    return { total: Object.values(counts).reduce((a, b) => a + b, 0), counts };
  });

  // Get section labels
  const labels = await p.evaluate(() => {
    const pane = document.querySelector('.leaflet-marker-pane');
    if (!pane) return [];
    const r = [];
    pane.querySelectorAll(':scope > div').forEach(d => {
      const cls = typeof d.className === 'string' ? d.className : '';
      if (cls.includes('map-site-label')) {
        const t = (d.innerText || '').trim();
        if (t) r.push(t);
      }
    });
    return r;
  });

  // Get available marker positions
  const available = await p.evaluate(() => {
    const pane = document.querySelector('.leaflet-marker-pane');
    if (!pane) return [];
    const r = [];
    pane.querySelectorAll(':scope > div').forEach(d => {
      const cls = typeof d.className === 'string' ? d.className : '';
      if (cls.includes('available') && cls.includes('maplink')) {
        const rect = d.getBoundingClientRect();
        r.push({ x: Math.round(rect.left + rect.width/2), y: Math.round(rect.top + rect.height/2) });
      }
    });
    return r;
  });

  // Click each available marker, get popup
  const sites = [];
  for (let i = 0; i < available.length; i++) {
    const m = available[i];
    await p.mouse.click(m.x, m.y);
    await p.waitForTimeout(1500);

    const popup = await p.evaluate(() => {
      const el = document.querySelector('.leaflet-popup-content');
      return el ? (el.innerText || '').trim() : null;
    });
    
    const siteNum = popup ? parseInt(popup.match(/\d+/)?.[0] || '0') : 0;
    const isAvail = popup?.startsWith('Available');
    
    if (siteNum > 0) {
      sites.push({ siteNum, isAvailable: isAvail, popup: popup?.substring(0, 200) });
    }

    await p.keyboard.press('Escape');
    await p.waitForTimeout(300);
  }

  const result = {
    campground: CAMP,
    dates: `${ARR}-${DEP}`,
    label: LABEL,
    sections: labels,
    markerStats: stats,
    availableCount: available.length,
    totalSitesFound: sites.length,
    sites: sites
  };

  fs.writeFileSync(OUT, JSON.stringify(result, null, 2));
  console.log(`\n✅ Results: ${sites.length} sites found`);
  console.log(JSON.stringify(result, null, 2));

  await b.close();
})();
