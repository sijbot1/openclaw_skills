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

function writePartial(waterfrontSites, allSites, sections) {
  const r = {
    campground: CAMP, dates: `${ARR}-${DEP}`, label: LABEL,
    sections: sections.map(s => s.text),
    availableCount: allSites.filter(s => s.isAvailable).length,
    totalSitesFound: allSites.length,
    waterfrontSites, allSites
  };
  fs.writeFileSync(OUT, JSON.stringify(r, null, 2));
}

(async () => {
  console.log(`SCANNING: ${CAMP} | ${ARR}-${DEP}`);

  const b = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const p = await b.newPage({ viewport: { width: 1440, height: 900 }, locale: 'en-CA', timezoneId: 'America/Toronto' });

  // Load SPA with stealth
  await p.goto('https://reservations.ontarioparks.ca/', { waitUntil: 'load', timeout: 60000 });
  for (let i = 0; i < 45; i++) {
    if (await p.evaluate(() => !!document.querySelector('#park-autocomplete-input'))) break;
    await p.waitForTimeout(1000);
  }

  if (!(await p.evaluate(() => !!document.querySelector('#park-autocomplete-input')))) {
    console.log('❌ SPA failed');
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

  // Zoom in
  for (let z = 0; z < 3; z++) { await p.keyboard.press('+'); await p.waitForTimeout(500); }
  await p.waitForTimeout(1000);

  // Get sections
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

  if (sections.length === 0) {
    // Check if there's any marker pane at all
    const hasPane = await p.evaluate(() => !!document.querySelector('.leaflet-marker-pane'));
    const hasMap = await p.evaluate(() => !!document.querySelector('.leaflet-container'));
    console.log(`Map: ${hasMap}, Pane: ${hasPane}, Sections: 0`);
    if (hasMap && hasPane) {
      // Map loaded but no section labels — maybe at wrong zoom. Try getting green dots directly
      const greens = await p.evaluate(() => {
        const pane = document.querySelector('.leaflet-marker-pane');
        if (!pane) return [];
        return Array.from(pane.querySelectorAll(':scope > div'))
          .filter(d => { const cls = typeof d.className === 'string' ? d.className : ''; return cls.includes('available') && d.getBoundingClientRect().width > 1; })
          .map(d => { const r = d.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2)}; });
      });
      console.log(`No sections but ${greens.length} green markers`);
    }
    writePartial([], [], [{ text: 'unknown' }]);
    await b.close(); return;
  }

  const allWaterfrontSites = [];
  const allSites = [];

  for (let si = 0; si < sections.length; si++) {
    const sec = sections[si];
    console.log(`\n--- Section ${si + 1}: ${sec.text} ---`);

    await panMapTo(p, sec.x, sec.y);
    await p.waitForTimeout(1000);

    const sectionShot = await shot(p, `section-${si + 1}-${sec.text.replace(/[^a-z0-9]/gi, '')}`);

    const greens = await p.evaluate(() => {
      const pane = document.querySelector('.leaflet-marker-pane');
      if (!pane) return [];
      return Array.from(pane.querySelectorAll(':scope > div'))
        .filter(d => { const cls = typeof d.className === 'string' ? d.className : ''; return cls.includes('available') && d.getBoundingClientRect().width > 1; })
        .map(d => { const r = d.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2)}; });
    });

    if (greens.length === 0) continue;
    const waterData = await checkWater(sectionShot, greens);
    const nearWater = waterData.filter(w => w.nearWater);
    console.log(`  Greens: ${greens.length}, Near water: ${nearWater.length}`);

    // Click max 15 markers per section
    const maxClicks = Math.min(greens.length, 15);
    for (let gi = 0; gi < maxClicks; gi++) {
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

      const siteInfo = { siteNum, section: sec.text, isAvailable: !!isAvail, waterDist: wf ? wf.waterDist : -1, nearWater: wf ? wf.nearWater : false, popup: popup?.substring(0, 200) || null };
      allSites.push(siteInfo);
      if (siteInfo.isAvailable && siteInfo.siteNum > 0) {
        console.log(`  Site ${siteNum}: ${isAvail ? '✅' : '❌'} water=${wf ? wf.waterDist + 'px' : '?'}`);
        if (siteInfo.nearWater) allWaterfrontSites.push(siteInfo);
      }
      await p.keyboard.press('Escape');
      await p.waitForTimeout(200);
    }

    // Write after each section
    writePartial(allWaterfrontSites, allSites, sections);
  }

  writePartial(allWaterfrontSites, allSites, sections);
  console.log(`\n✅ ${allWaterfrontSites.length} waterfront sites found`);
  allWaterfrontSites.sort((a, b) => a.waterDist - b.waterDist).forEach(s =>
    console.log(`  Site ${s.siteNum} in ${s.section} — ${s.waterDist}px from water`));

  await shot(p, 'final');
  await b.close();
})();
