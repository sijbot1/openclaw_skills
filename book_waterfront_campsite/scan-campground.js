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

// Pixel-level water detection
async function checkWater(imgPath, markers, pad = 40) {
  const sharp = require('sharp');
  const img = sharp(imgPath);
  const meta = await img.metadata();
  const buf = await img.raw().toBuffer();
  const { width, height } = meta;
  const res = [];
  for (const m of markers) {
    if (m.x < 0 || m.x >= width || m.y < 0 || m.y >= height) { res.push({ ...m, waterDist: -1, nearWater: false }); continue; }
    let best = Infinity;
    for (let d = 1; d <= pad; d++) {
      for (const [dx, dy] of [[d, 0], [-d, 0], [0, d], [0, -d], [d, d], [-d, d], [d, -d], [-d, -d]]) {
        const px = m.x + dx, py = m.y + dy;
        if (px < 0 || px >= width || py < 0 || py >= height) continue;
        const idx = (py * width + px) * 4;
        const r = buf[idx], g = buf[idx + 1], bl = buf[idx + 2];
        if (bl > 80 && bl > r * 1.2 && bl > g * 1.1 && d < best) best = d;
      }
    }
    res.push({ ...m, waterDist: best === Infinity ? -1 : best, nearWater: best <= 20 });
  }
  return res;
}

// Pan map to bring a screen coordinate to center using Leaflet API
async function panMapTo(p, targetX, targetY) {
  return await p.evaluate(({ tx, ty }) => {
    const mapDiv = document.querySelector('.leaflet-container');
    if (!mapDiv) return false;
    const searchForMap = (obj, depth = 0) => {
      if (depth > 3 || !obj) return null;
      for (const k of Object.getOwnPropertyNames(obj)) {
        try { const v = obj[k]; if (v && typeof v === 'object' && v.panBy && v.getCenter) return v; } catch (e) { continue; }
      }
      return null;
    };
    let map = searchForMap(mapDiv);
    if (!map) {
      for (const k of Object.getOwnPropertyNames(mapDiv)) {
        try { map = searchForMap(mapDiv[k], 1); if (map) break; } catch (e) { continue; }
      }
    }
    if (!map) return false;
    const center = map.getCenter();
    const pxCenter = map.latLngToContainerPoint(center);
    map.panBy([tx - pxCenter.x, ty - pxCenter.y], { animate: true, duration: 0.3 });
    return true;
  }, { tx: targetX, ty: targetY });
}

(async () => {
  console.log(`SCANNING: ${CAMP} | ${ARR}-${DEP}`);

  const b = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const p = await b.newPage({ viewport: { width: 1440, height: 900 }, locale: 'en-CA', timezoneId: 'America/Toronto' });

  // Load SPA with retry
  for (let attempt = 0; attempt < 3; attempt++) {
    await p.goto('https://reservations.ontarioparks.ca/', { waitUntil: 'load', timeout: 60000 });
    for (let i = 0; i < 40; i++) {
      if (await p.evaluate(() => !!document.querySelector('#park-autocomplete-input'))) break;
      await p.waitForTimeout(1000);
    }
    if (await p.evaluate(() => !!document.querySelector('#park-autocomplete-input'))) break;
    console.log(`  Retry ${attempt + 1}...`);
  }

  if (!(await p.evaluate(() => !!document.querySelector('#park-autocomplete-input')))) {
    console.log('❌ Could not load SPA');
    await shot(p, 'failed');
    await b.close(); return;
  }

  // Search
  await p.locator('#park-autocomplete-input').click({ force: true }).catch(() => {});
  await p.waitForTimeout(100);
  await p.locator('#park-autocomplete-input').fill('');
  await p.locator('#park-autocomplete-input').type(CAMP, { delay: 10 });
  await p.waitForTimeout(1000);
  await p.locator('mat-option').first().click({ force: true });
  await p.waitForTimeout(300);
  await p.keyboard.press('Escape'); await p.waitForTimeout(100);
  await p.locator('#arrival-date-field').click({ force: true });
  await p.waitForTimeout(600);
  await p.locator(`.mat-calendar-body-cell-content:has-text("${ARR}")`).first().click({ force: true });
  await p.waitForTimeout(200);
  await p.locator(`.mat-calendar-body-cell-content:has-text("${DEP}")`).first().click({ force: true });
  await p.waitForTimeout(200);
  await p.locator('#party-size-field').click({ force: true }).catch(() => {});
  await p.locator('#party-size-field').fill('2');
  await p.locator('#equipment-field').click({ force: true });
  await p.waitForTimeout(400);
  await p.locator('mat-option:has-text("Single Tent")').first().click({ force: true });
  await p.waitForTimeout(100);
  await p.locator('button:has-text("Search")').click();
  await p.waitForTimeout(8000);

  console.log('Map loaded');

  // Step 1: Zoom in 3 levels using keyboard + 
  for (let z = 0; z < 3; z++) { await p.keyboard.press('+'); await p.waitForTimeout(500); }
  await p.waitForTimeout(1000);
  await shot(p, 'zoomed-in');

  // Step 2: Get all section/campground labels with their screen positions
  const sections = await p.evaluate(() => {
    const pane = document.querySelector('.leaflet-marker-pane');
    if (!pane) return [];
    const r = [];
    pane.querySelectorAll(':scope > div').forEach(d => {
      const cls = typeof d.className === 'string' ? d.className : '';
      if (cls.includes('map-site-label')) {
        const t = (d.innerText || '').trim();
        if (t && t.length < 30) {
          const rect = d.getBoundingClientRect();
          r.push({ text: t, x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) });
        }
      }
    });
    return r;
  });
  console.log(`Sections: ${sections.length}`);
  sections.forEach(s => console.log(`  ${s.text} at (${s.x}, ${s.y})`));

  // Step 3: For EACH section, pan to it, scan green markers, check water proximity
  const allWaterfrontSites = [];
  const allSites = [];

  for (let si = 0; si < sections.length; si++) {
    const sec = sections[si];
    console.log(`\n--- Section ${si + 1}: ${sec.text} ---`);

    // Pan the map to center this section
    const panned = await panMapTo(p, sec.x, sec.y);
    console.log(`  Panned: ${panned}`);
    await p.waitForTimeout(1500);

    // Take screenshot of this section
    const sectionShot = await shot(p, `section-${si + 1}-${sec.text.replace(/[^a-z0-9]/gi, '')}`);

    // Get available (green) markers visible
    const greens = await p.evaluate(() => {
      const pane = document.querySelector('.leaflet-marker-pane');
      if (!pane) return [];
      return Array.from(pane.querySelectorAll(':scope > div'))
        .filter(d => {
          const cls = typeof d.className === 'string' ? d.className : '';
          return cls.includes('available') && d.getBoundingClientRect().width > 1;
        })
        .map(d => {
          const r = d.getBoundingClientRect();
          return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
        });
    });
    console.log(`  Green markers: ${greens.length}`);

    if (greens.length === 0) continue;

    // Check water proximity via pixel analysis on the screenshot
    const waterData = await checkWater(sectionShot, greens);
    const nearWater = waterData.filter(w => w.nearWater);
    console.log(`  Near water: ${nearWater.length}`);

    // Click each green marker to get site number
    for (let gi = 0; gi < greens.length; gi++) {
      const g = greens[gi];
      await p.mouse.click(g.x, g.y);
      await p.waitForTimeout(800);

      const popup = await p.evaluate(() => {
        const el = document.querySelector('.leaflet-popup-content');
        return el ? (el.innerText || '').trim() : null;
      });

      const siteNum = popup ? parseInt(popup.match(/\d+/)?.[0] || 0) : 0;
      const isAvail = popup?.startsWith('Available');
      const wf = waterData.find(w => Math.abs(w.x - g.x) < 3 && Math.abs(w.y - g.y) < 3);

      const siteInfo = {
        siteNum,
        section: sec.text,
        isAvailable: !!isAvail,
        waterDist: wf ? wf.waterDist : -1,
        nearWater: wf ? wf.nearWater : false,
        popup: popup?.substring(0, 200) || null
      };

      allSites.push(siteInfo);
      if (siteInfo.isAvailable && siteInfo.siteNum > 0) {
        console.log(`  Site ${siteNum}: ${isAvail ? '✅' : '❌'} water=${wf ? wf.waterDist + 'px' : '?'}`);
        if (siteInfo.nearWater) allWaterfrontSites.push(siteInfo);
      }

      await p.keyboard.press('Escape');
      await p.waitForTimeout(200);
    }
  }

  // Results
  const result = {
    campground: CAMP,
    dates: `${ARR}-${DEP}`,
    label: LABEL,
    sections: sections.map(s => s.text),
    availableCount: allSites.filter(s => s.isAvailable).length,
    totalSitesFound: allSites.length,
    waterfrontSites: allWaterfrontSites,
    allSites
  };

  fs.writeFileSync(OUT, JSON.stringify(result, null, 2));
  console.log(`\n✅ Written to ${OUT}`);

  // Print waterfront summary
  if (allWaterfrontSites.length > 0) {
    console.log(`\n🌊 WATERFRONT SITES FOUND:`);
    allWaterfrontSites.sort((a, b) => a.waterDist - b.waterDist);
    allWaterfrontSites.forEach(s => {
      console.log(`  Site ${s.siteNum} in ${s.section} — ${s.waterDist}px from water`);
    });
  } else {
    console.log(`\n❌ No waterfront sites found for this search.`);
  }

  await shot(p, 'final');
  await b.close();
})();
