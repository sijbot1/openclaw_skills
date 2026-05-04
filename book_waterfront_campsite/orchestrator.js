#!/usr/bin/env node
/**
 * Waterfront Campsite Orchestrator v3 — Full Season Sweep
 *
 * Scans ALL regions/parks/campgrounds for ALL weekend dates
 * May through September. Collects ALL results (no early stop).
 * Reports ranked best finds at the end.
 */

const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const SCRIPT = path.join(__dirname, 'scan-campground.js');
const RESULTS_DIR = path.join(__dirname, 'results');
fs.mkdirSync(RESULTS_DIR, { recursive: true });

// ─── SEARCH SPACE ───
const REGIONS = [
  {
    name: 'Algonquin Park',
    parks: [
      { name: 'Algonquin', campgrounds: [
        'Algonquin - Pog Lake & Kearney Lake',
        'Algonquin - Mew Lake',
        'Algonquin - Rock Lake & Raccoon Lake',
        'Algonquin - Canisbay Lake',
        'Algonquin - Lake Of Two Rivers',
      ]}
    ]
  },
  {
    name: 'Georgian Bay / Muskoka',
    parks: [
      { name: 'Killbear', campgrounds: [] },
      { name: 'Awenda', campgrounds: [] },
      { name: 'Six Mile Lake', campgrounds: [] },
      { name: 'Arrowhead', campgrounds: [] },
    ]
  },
  {
    name: 'Lake Huron / Southwestern',
    parks: [
      { name: 'Pinery', campgrounds: [] },
      { name: 'Rondeau', campgrounds: [] },
      { name: 'Rock Point', campgrounds: [] },
    ]
  },
  {
    name: 'Lake Ontario / Eastern',
    parks: [
      { name: 'Sandbanks', campgrounds: [] },
      { name: "Presqu'ile", campgrounds: [] },
      { name: 'Bon Echo', campgrounds: [] },
      { name: 'Charleston Lake', campgrounds: [] },
    ]
  }
];

// ─── WEEKEND DATES: May through September ───
// Each entry: { month (1-12), arr (day), dep (day), label }
const DATES = [
  { month: 5, arr: '23', dep: '24', label: 'May 23-24' },
  { month: 5, arr: '30', dep: '31', label: 'May 30-31' },
  { month: 6, arr: '06', dep: '07', label: 'June 6-7' },
  { month: 6, arr: '13', dep: '14', label: 'June 13-14' },
  { month: 6, arr: '20', dep: '21', label: 'June 20-21' },
  { month: 6, arr: '27', dep: '28', label: 'June 27-28' },
  { month: 7, arr: '04', dep: '05', label: 'July 4-5' },
  { month: 7, arr: '11', dep: '12', label: 'July 11-12' },
  { month: 7, arr: '18', dep: '19', label: 'July 18-19' },
  { month: 7, arr: '25', dep: '26', label: 'July 25-26' },
  { month: 8, arr: '01', dep: '02', label: 'Aug 1-2' },
  { month: 8, arr: '08', dep: '09', label: 'Aug 8-9' },
  { month: 8, arr: '15', dep: '16', label: 'Aug 15-16' },
  { month: 8, arr: '22', dep: '23', label: 'Aug 22-23' },
  { month: 8, arr: '29', dep: '30', label: 'Aug 29-30' },
  { month: 9, arr: '05', dep: '06', label: 'Sep 5-6' },
  { month: 9, arr: '12', dep: '13', label: 'Sep 12-13' },
  { month: 9, arr: '19', dep: '20', label: 'Sep 19-20' },
  { month: 9, arr: '26', dep: '27', label: 'Sep 26-27' },
];

// Track all finds for final report
const allFinds = [];

function cleanLabel(s) { return s.replace(/[^a-z0-9]/gi, '').substring(0, 40); }

// ─── DISCOVER CAMPGROUNDS ───
async function discoverCampgrounds(parkName) {
  const cacheKey = cleanLabel(parkName);
  const cacheFile = path.join(__dirname, `.campgrounds-${cacheKey}.json`);
  if (fs.existsSync(cacheFile)) {
    const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    if (cached.length > 0) return cached;
  }

  console.log(`\n🔍 Discovering campgrounds for "${parkName}"...`);
  const resultFile = path.join(RESULTS_DIR, `_discover_${cacheKey}.json`);

  const discoverScript = `
    const { chromium } = require('playwright-extra');
    const StealthPlugin = require('puppeteer-extra-plugin-stealth');
    chromium.use(StealthPlugin());
    const fs = require('fs'); const path = require('path');
    (async()=>{
      const b = await chromium.launch({headless:true,args:['--no-sandbox']});
      const p = await b.newPage({viewport:{width:1440,height:900}});
      await p.goto('https://reservations.ontarioparks.ca/',{waitUntil:'load',timeout:60000});
      for(let i=0;i<30;i++){if(await p.evaluate(()=>!!document.querySelector('#park-autocomplete-input')))break;await p.waitForTimeout(1000);}
      const input = p.locator('#park-autocomplete-input');
      await input.click({force:true}).catch(()=>{}); await p.waitForTimeout(100);
      await input.fill(''); await input.type(${JSON.stringify(parkName)},{delay:10}); await p.waitForTimeout(2000);
      const opts = await p.evaluate(() => Array.from(document.querySelectorAll('mat-option')).map(o=>o.innerText.trim()).filter(t=>t));
      fs.writeFileSync(${JSON.stringify(resultFile)}, JSON.stringify({park:${JSON.stringify(parkName)},campgrounds:opts}));
      console.log(JSON.stringify(opts));
      await b.close();
    })();
  `;

  try {
    const out = execSync(`cd ${__dirname} && timeout 90 node -e ${JSON.stringify(discoverScript)}`, { maxBuffer: 1024*1024, timeout: 90000 }).toString();
    const jsonLine = out.trim().split('\n').find(l => l.startsWith('['));
    if (jsonLine) {
      const options = JSON.parse(jsonLine);
      let campgrounds = options.filter(o => o.startsWith(parkName + ' - '));
      if (campgrounds.length === 0 && options.length > 0) {
        campgrounds = options;
        console.log(`  Park name(s): ${campgrounds.map(c => c.substring(0,40)).join(', ')}`);
      } else {
        console.log(`  Campgrounds: ${campgrounds.map(c => c.replace(parkName+' - ','')).join(', ')}`);
      }
      fs.writeFileSync(cacheFile, JSON.stringify(campgrounds, null, 2));
      return campgrounds;
    }
  } catch(e) { console.log(`  Discovery error: ${e.message.substring(0,80)}`); }
  return [];
}

// ─── RUN SINGLE SCAN ───
async function runScan(campground, month, arr, dep) {
  const label = `${cleanLabel(campground)}-m${month}-${arr}-${dep}`.substring(0, 60);
  const resultFile = path.join(__dirname, `results-${label}.json`);
  const logFile = path.join(RESULTS_DIR, `${label}.log`);

  console.log(`\n  🔎 Scanning: ${campground} (${arr}-${dep}, month ${month})`);

  return new Promise((resolve) => {
    const proc = spawn('bash', ['-c',
      `CAMP="${campground.replace(/"/g, '\\"')}" MONTH=${month} ARR_DAY=${arr} DEP_DAY=${dep} LABEL=${label} timeout 600 node ${SCRIPT}`],
      { stdio: ['pipe', fs.openSync(logFile, 'w'), fs.openSync(logFile, 'w')] }
    );

    proc.on('exit', () => {
      let data = null;
      try { if (fs.existsSync(resultFile)) data = JSON.parse(fs.readFileSync(resultFile, 'utf8')); } catch(e) {}
      const foundWF = data?.waterfrontSites?.length > 0;
      const wfCount = data?.waterfrontSites?.length || 0;
      const availCount = data?.availableCount || 0;
      console.log(`    ${foundWF ? '✅ Waterfront!' : '❌'} (${availCount} avail, ${wfCount} waterfront)`);
      resolve({ label, campground, month, arr, dep, data, waterfront: data?.waterfrontSites || [], availableCount: availCount });
    });

    proc.on('error', () => resolve({ label, campground, month, arr, dep, data: null, waterfront: [], availableCount: 0 }));
  });
}

// ─── MAIN LOOP ───
async function run() {
  console.log('🌊🌊🌊 WATERFRONT CAMPSITE ORCHESTRATOR v3 — FULL SEASON');
  console.log('Scanning ALL regions/parks for ALL weekend dates May–Sept\n');

  let totalScans = 0;
  let totalFinds = 0;

  for (const date of DATES) {
    const { month, arr, dep, label } = date;
    console.log(`\n${'='.repeat(60)}`);
    console.log(`📅 ${label}`);
    console.log(`${'='.repeat(60)}`);

    for (const region of REGIONS) {
      console.log(`\n📍 ${region.name}`);

      for (const park of region.parks) {
        let campgrounds = park.campgrounds;
        if (campgrounds.length === 0) {
          const discovered = await discoverCampgrounds(park.name);
          campgrounds = discovered;
          park.campgrounds = discovered;
        }
        if (campgrounds.length === 0) {
          console.log(`  ⏭️ ${park.name}: no campgrounds`);
          continue;
        }

        console.log(`\n🏞️  ${park.name}`);
        for (const campground of campgrounds) {
          totalScans++;
          const result = await runScan(campground, month, arr, dep);

          if (result.waterfront.length > 0) {
            totalFinds++;
            // Deduplicate by looking at unique site numbers near water
            const uniqSites = new Map();
            for (const s of result.waterfront) {
              if (s.siteNum > 0 && s.nearWater && s.isAvailable) {
                const key = `${s.siteNum}-${s.section}`;
                if (!uniqSites.has(key) || uniqSites.get(key).waterDist > s.waterDist) {
                  uniqSites.set(key, s);
                }
              }
            }
            allFinds.push({
              campground,
              dateLabel: label,
              arr, dep, month,
              sites: [...uniqSites.values()].sort((a, b) => a.waterDist - b.waterDist),
              totalWaterfront: result.waterfront.length,
              availableCount: result.availableCount,
            });
          }
        }
      }
    }
  }

  // ─── FINAL REPORT ───
  console.log(`\n\n${'='.repeat(60)}`);
  console.log(`📊 FINAL REPORT — ${totalFinds} finds from ${totalScans} scans`);
  console.log(`${'='.repeat(60)}`);

  if (allFinds.length === 0) {
    console.log('\n😔 No waterfront campsites found in any region for any date.');
    process.exit(0);
  }

  // Group by park for readability
  const byPark = {};
  for (const find of allFinds) {
    const parkName = find.campground.replace(/ - .*$/, '');
    if (!byPark[parkName]) byPark[parkName] = [];
    byPark[parkName].push(find);
  }

  for (const [parkName, finds] of Object.entries(byPark).sort()) {
    console.log(`\n🏞️  ${parkName}`);
    // Sort finds by date (month + day)
    finds.sort((a, b) => a.month - b.month || parseInt(a.arr) - parseInt(b.arr));
    for (const f of finds) {
      const bestSites = f.sites.slice(0, 5).map(s => `Site ${s.siteNum} (${s.section}, ${s.waterDist}px)`).join(', ');
      console.log(`  ${f.dateLabel}: ${f.availableCount} avail, ${f.totalWaterfront} waterfront — ${bestSites}`);
    }
  }

  // Best overall find
  console.log(`\n${'='.repeat(60)}`);
  console.log('🏆 BEST OVERALL FINDS (by water proximity & availability):');
  allFinds.sort((a, b) => {
    const aBest = a.sites[0]?.waterDist || 999;
    const bBest = b.sites[0]?.waterDist || 999;
    return aBest - bBest;
  });
  allFinds.slice(0, 10).forEach((f, i) => {
    const best = f.sites[0];
    console.log(`  ${i+1}. ${f.campground} — ${f.dateLabel} — Site ${best?.siteNum} (${best?.waterDist}px from water, ${best?.section})`);
  });

  console.log(`\n✅ Full sweep complete. ${totalFinds} waterfront date/park combos found.`);
}

run().catch(console.error);
